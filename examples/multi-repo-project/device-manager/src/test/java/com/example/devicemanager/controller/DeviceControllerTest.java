package com.example.devicemanager.controller;

import com.example.devicemanager.dto.BatchDeleteRequest;
import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.AuthType;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import com.example.devicemanager.service.DeviceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(DeviceController.class)
@AutoConfigureMockMvc(addFilters = false)
class DeviceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DeviceService deviceService;

    @Test
    void batchDeleteDevices_success_allDeleted() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(true);
        response.setDeleted(deviceIds);
        response.setFailed(new ArrayList<>());
        response.setTotalRequested(3);
        response.setTotalDeleted(3);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.total_requested").value(3))
                .andExpect(jsonPath("$.total_deleted").value(3))
                .andExpect(jsonPath("$.deleted.length()").value(3))
                .andExpect(jsonPath("$.failed.length()").value(0));
    }

    @Test
    void batchDeleteDevices_partialSuccess_someDevicesNotFound() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(false);
        response.setDeleted(Arrays.asList("device1", "device3"));
        List<BatchDeleteResponse.BatchDeleteError> failed = new ArrayList<>();
        failed.add(new BatchDeleteResponse.BatchDeleteError("device2", "Device not found"));
        response.setFailed(failed);
        response.setTotalRequested(3);
        response.setTotalDeleted(2);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.total_requested").value(3))
                .andExpect(jsonPath("$.total_deleted").value(2))
                .andExpect(jsonPath("$.deleted.length()").value(2))
                .andExpect(jsonPath("$.failed.length()").value(1))
                .andExpect(jsonPath("$.failed[0].device_id").value("device2"))
                .andExpect(jsonPath("$.failed[0].error").value("Device not found"));
    }

    @Test
    void batchDeleteDevices_badRequest_emptyDeviceIds() throws Exception {
        // Arrange
        BatchDeleteRequest request = new BatchDeleteRequest(new ArrayList<>());

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void batchDeleteDevices_badRequest_nullDeviceIds() throws Exception {
        // Arrange
        BatchDeleteRequest request = new BatchDeleteRequest(null);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void batchDeleteDevices_allFailed_allDevicesNotFound() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(false);
        response.setDeleted(new ArrayList<>());
        List<BatchDeleteResponse.BatchDeleteError> failed = new ArrayList<>();
        failed.add(new BatchDeleteResponse.BatchDeleteError("device1", "Device not found"));
        failed.add(new BatchDeleteResponse.BatchDeleteError("device2", "Device not found"));
        response.setFailed(failed);
        response.setTotalRequested(2);
        response.setTotalDeleted(0);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.total_requested").value(2))
                .andExpect(jsonPath("$.total_deleted").value(0))
                .andExpect(jsonPath("$.deleted.length()").value(0))
                .andExpect(jsonPath("$.failed.length()").value(2));
    }

    @Test
    void getDevice_withAuthFields_passwordNotReturned() throws Exception {
        // Arrange
        Device device = new Device();
        device.setId("device1");
        device.setName("Test Device");
        device.setStatus(DeviceStatus.ONLINE);
        device.setAuthType(AuthType.BASIC);
        device.setAuthUsername("admin");
        device.setAuthPassword("$2a$10$encryptedPasswordHash"); // Encrypted password
        device.setAuthEnabled(true);
        device.setLastAuthUpdate(Instant.parse("2026-02-14T10:00:00Z"));

        when(deviceService.getDevice("device1")).thenReturn(Optional.of(device));

        // Act & Assert
        mockMvc.perform(get("/api/devices/device1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("device1"))
                .andExpect(jsonPath("$.name").value("Test Device"))
                .andExpect(jsonPath("$.authType").value("BASIC"))
                .andExpect(jsonPath("$.authUsername").value("admin"))
                .andExpect(jsonPath("$.authPassword").doesNotExist()) // Password should NOT be returned
                .andExpect(jsonPath("$.authEnabled").value(true))
                .andExpect(jsonPath("$.lastAuthUpdate").exists());
    }

    @Test
    void listDevices_withAuthFields_passwordsNotReturned() throws Exception {
        // Arrange
        Device device1 = new Device();
        device1.setId("device1");
        device1.setName("Device 1");
        device1.setStatus(DeviceStatus.ONLINE);
        device1.setAuthType(AuthType.BASIC);
        device1.setAuthUsername("admin");
        device1.setAuthPassword("$2a$10$encryptedHash1");
        device1.setAuthEnabled(true);

        Device device2 = new Device();
        device2.setId("device2");
        device2.setName("Device 2");
        device2.setStatus(DeviceStatus.ONLINE);
        device2.setAuthType(AuthType.TOKEN);
        device2.setAuthToken("secret-token-123");
        device2.setAuthPassword("$2a$10$encryptedHash2");
        device2.setAuthEnabled(true);

        when(deviceService.listDevices(null)).thenReturn(Arrays.asList(device1, device2));

        // Act & Assert
        mockMvc.perform(get("/api/devices"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("device1"))
                .andExpect(jsonPath("$[0].authUsername").value("admin"))
                .andExpect(jsonPath("$[0].authPassword").doesNotExist()) // Password should NOT be returned
                .andExpect(jsonPath("$[1].id").value("device2"))
                .andExpect(jsonPath("$[1].authToken").value("secret-token-123"))
                .andExpect(jsonPath("$[1].authPassword").doesNotExist()); // Password should NOT be returned
    }

    @Test
    void getDevice_withTokenAuth_tokenReturned() throws Exception {
        // Arrange
        Device device = new Device();
        device.setId("device1");
        device.setName("Test Device");
        device.setStatus(DeviceStatus.ONLINE);
        device.setAuthType(AuthType.TOKEN);
        device.setAuthToken("abc123xyz");
        device.setAuthEnabled(true);
        device.setLastAuthUpdate(Instant.parse("2026-02-14T10:00:00Z"));

        when(deviceService.getDevice("device1")).thenReturn(Optional.of(device));

        // Act & Assert
        mockMvc.perform(get("/api/devices/device1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("device1"))
                .andExpect(jsonPath("$.authType").value("TOKEN"))
                .andExpect(jsonPath("$.authToken").value("abc123xyz"))
                .andExpect(jsonPath("$.authPassword").doesNotExist())
                .andExpect(jsonPath("$.authEnabled").value(true));
    }

    @Test
    void getDevice_withSSHKey_keyReturned() throws Exception {
        // Arrange
        Device device = new Device();
        device.setId("device1");
        device.setName("Test Device");
        device.setStatus(DeviceStatus.ONLINE);
        device.setAuthType(AuthType.SSH_KEY);
        device.setSshPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ...");
        device.setAuthEnabled(true);
        device.setLastAuthUpdate(Instant.parse("2026-02-14T10:00:00Z"));

        when(deviceService.getDevice("device1")).thenReturn(Optional.of(device));

        // Act & Assert
        mockMvc.perform(get("/api/devices/device1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("device1"))
                .andExpect(jsonPath("$.authType").value("SSH_KEY"))
                .andExpect(jsonPath("$.sshPublicKey").value("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ..."))
                .andExpect(jsonPath("$.authPassword").doesNotExist())
                .andExpect(jsonPath("$.authEnabled").value(true));
    }
}
