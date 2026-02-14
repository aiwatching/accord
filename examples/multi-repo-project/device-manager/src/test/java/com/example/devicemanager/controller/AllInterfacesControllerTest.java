package com.example.devicemanager.controller;

import com.example.devicemanager.dto.AllInterfacesResponse;
import com.example.devicemanager.dto.InterfaceWithDevice;
import com.example.devicemanager.dto.PaginationMetadata;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.service.NetworkInterfaceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Arrays;
import java.util.Collections;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(AllInterfacesController.class)
class AllInterfacesControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private NetworkInterfaceService interfaceService;

    @Test
    void getAllInterfaces_noFilters_returnsAllInterfaces() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        InterfaceWithDevice iface2 = createTestInterfaceWithDevice("iface2", "device2", "Device-2", "wlan0");
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 2);
        AllInterfacesResponse response = new AllInterfacesResponse(Arrays.asList(iface1, iface2), pagination);

        when(interfaceService.listAllInterfaces(null, null, null, null, 1, 50)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(2))
                .andExpect(jsonPath("$.interfaces[0].id").value("iface1"))
                .andExpect(jsonPath("$.interfaces[0].deviceName").value("Device-1"))
                .andExpect(jsonPath("$.interfaces[1].id").value("iface2"))
                .andExpect(jsonPath("$.interfaces[1].deviceName").value("Device-2"))
                .andExpect(jsonPath("$.pagination.page").value(1))
                .andExpect(jsonPath("$.pagination.pageSize").value(50))
                .andExpect(jsonPath("$.pagination.totalItems").value(2))
                .andExpect(jsonPath("$.pagination.totalPages").value(1));
    }

    @Test
    void getAllInterfaces_withDeviceIdFilter_returnsFilteredInterfaces() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 1);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.singletonList(iface1), pagination);

        when(interfaceService.listAllInterfaces(eq("device1"), eq(null), eq(null), eq(null), eq(1), eq(50)))
                .thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces").param("deviceId", "device1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(1))
                .andExpect(jsonPath("$.interfaces[0].deviceId").value("device1"))
                .andExpect(jsonPath("$.pagination.totalItems").value(1));
    }

    @Test
    void getAllInterfaces_withTypeFilter_returnsFilteredInterfaces() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        iface1.setType(InterfaceType.ETHERNET);
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 1);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.singletonList(iface1), pagination);

        when(interfaceService.listAllInterfaces(eq(null), eq(InterfaceType.ETHERNET), eq(null), eq(null), eq(1), eq(50)))
                .thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces").param("type", "ETHERNET"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(1))
                .andExpect(jsonPath("$.interfaces[0].type").value("ETHERNET"));
    }

    @Test
    void getAllInterfaces_withStatusFilter_returnsFilteredInterfaces() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        iface1.setStatus(InterfaceStatus.UP);
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 1);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.singletonList(iface1), pagination);

        when(interfaceService.listAllInterfaces(eq(null), eq(null), eq(InterfaceStatus.UP), eq(null), eq(1), eq(50)))
                .thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces").param("status", "UP"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(1))
                .andExpect(jsonPath("$.interfaces[0].status").value("UP"));
    }

    @Test
    void getAllInterfaces_withEnabledFilter_returnsFilteredInterfaces() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        iface1.setEnabled(true);
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 1);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.singletonList(iface1), pagination);

        when(interfaceService.listAllInterfaces(eq(null), eq(null), eq(null), eq(true), eq(1), eq(50)))
                .thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces").param("enabled", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(1))
                .andExpect(jsonPath("$.interfaces[0].enabled").value(true));
    }

    @Test
    void getAllInterfaces_withPagination_returnsCorrectPage() throws Exception {
        // Arrange
        InterfaceWithDevice iface1 = createTestInterfaceWithDevice("iface1", "device1", "Device-1", "eth0");
        PaginationMetadata pagination = new PaginationMetadata(2, 10, 25);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.singletonList(iface1), pagination);

        when(interfaceService.listAllInterfaces(null, null, null, null, 2, 10)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces")
                        .param("page", "2")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagination.page").value(2))
                .andExpect(jsonPath("$.pagination.pageSize").value(10))
                .andExpect(jsonPath("$.pagination.totalItems").value(25))
                .andExpect(jsonPath("$.pagination.totalPages").value(3));
    }

    @Test
    void getAllInterfaces_invalidPagination_returns400() throws Exception {
        // Arrange
        when(interfaceService.listAllInterfaces(any(), any(), any(), any(), anyInt(), anyInt()))
                .thenThrow(new IllegalArgumentException("Invalid page"));

        // Act & Assert
        mockMvc.perform(get("/api/interfaces").param("page", "0"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getAllInterfaces_emptyResults_returnsEmptyList() throws Exception {
        // Arrange
        PaginationMetadata pagination = new PaginationMetadata(1, 50, 0);
        AllInterfacesResponse response = new AllInterfacesResponse(Collections.emptyList(), pagination);

        when(interfaceService.listAllInterfaces(null, null, null, null, 1, 50)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/interfaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interfaces.length()").value(0))
                .andExpect(jsonPath("$.pagination.totalItems").value(0));
    }

    private InterfaceWithDevice createTestInterfaceWithDevice(String id, String deviceId, String deviceName, String name) {
        InterfaceWithDevice iface = new InterfaceWithDevice();
        iface.setId(id);
        iface.setDeviceId(deviceId);
        iface.setDeviceName(deviceName);
        iface.setName(name);
        iface.setType(InterfaceType.ETHERNET);
        iface.setMacAddress("AA:BB:CC:DD:EE:FF");
        iface.setIpAddress("192.168.1.1");
        iface.setStatus(InterfaceStatus.UP);
        iface.setEnabled(true);
        return iface;
    }
}
